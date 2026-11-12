"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBasemapController } = require("../assets/record-explorer.js");

// Images and tile layers are controlled doubles: the tests make no tile requests.
// Keep archived callbacks after .off() so race tests exercise the controller's
// identity/generation guard rather than passing only because listeners detached.
function harness() {
  const layers = [];
  const states = [];
  const attached = new Set();
  const removed = [];
  const map = {
    addLayer(layer) { attached.add(layer); return this; },
    removeLayer(layer) { attached.delete(layer); removed.push(layer); return this; },
    hasLayer(layer) { return attached.has(layer); }
  };
  const leaflet = {
    tileLayer(url, options) {
      const active = new Map();
      const archived = new Map();
      const layer = {
        url,
        options,
        on(name, callback) {
          if (typeof name === "object") {
            Object.entries(name).forEach(([event, handler]) => this.on(event, handler));
            return this;
          }
          for (const event of name.split(/\s+/u)) {
            const registered = active.get(event) || [];
            registered.push(callback); active.set(event, registered);
            const history = archived.get(event) || [];
            history.push(callback); archived.set(event, history);
          }
          return this;
        },
        off(name, callback) {
          if (name === undefined) active.clear();
          else if (typeof name === "object") Object.entries(name).forEach(([event, handler]) => this.off(event, handler));
          else if (callback) active.set(name, (active.get(name) || []).filter((handler) => handler !== callback));
          else active.delete(name);
          return this;
        },
        addTo(target) { target.addLayer(this); return this; },
        remove() { map.removeLayer(this); return this; },
        removeFrom(target) { target.removeLayer(this); return this; },
        bringToBack() { return this; },
        fire(event, payload = {}) {
          for (const handler of active.get(event) || []) handler({ type: event, target: this, ...payload });
          return this;
        },
        captured(event) {
          return [...(archived.get(event) || [])].map((handler) => (payload = {}) => handler({ type: event, target: this, ...payload }));
        }
      };
      layers.push(layer);
      return layer;
    }
  };
  const controller = createBasemapController({ leaflet, map, onState: (state) => states.push({ ...state }) });
  return { controller, layers, states, attached, removed };
}

function tile() {
  const attributes = new Map();
  return {
    style: {},
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; }
  };
}

function late(callbacks, payload) {
  callbacks.forEach((callback) => callback(payload));
}

test("no third-party layer is created until the visitor selects a provider", () => {
  const h = harness();
  assert.equal(h.layers.length, 0);
  assert.equal(h.attached.size, 0);
  assert.deepEqual(h.controller.getState(), { provider: "none", status: "none", errors: 0, active: false });
  assert.equal(h.controller.retry(), false, "retry while off must not opt into a provider");
  assert.equal(h.layers.length, 0);
});

test("both providers configure an origin Referer without tile cachebuster URLs", () => {
  const h = harness();
  h.controller.select("streets");
  h.controller.select("satellite");
  assert.equal(h.layers.length, 2);
  assert.match(h.layers[0].url, /^https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png$/u);
  assert.match(h.layers[1].url, /^https:\/\/services\.arcgisonline\.com\//u);
  for (const layer of h.layers) {
    assert.equal(layer.options.referrerPolicy, "strict-origin-when-cross-origin");
    assert.equal(layer.options.crossOrigin, false);
    assert.doesNotMatch(layer.url, /[?&](?:_t|t|cache|nocache|v)=/iu);
  }
});

test("a complete successful load is available only while there are zero errors", () => {
  const h = harness();
  h.controller.select("streets");
  assert.equal(h.controller.getState().status, "loading");
  h.layers[0].fire("load");
  assert.equal(h.controller.getState().status, "available");
  assert.equal(h.controller.getState().errors, 0);
  assert.equal(h.controller.getState().active, true);
});

test("first and second failed images are hidden and load cannot erase the warning", () => {
  const h = harness();
  h.controller.select("streets");
  const layer = h.layers[0];
  for (let count = 1; count <= 2; count += 1) {
    const failed = tile();
    layer.fire("tileerror", { tile: failed });
    assert.equal(failed.style.visibility, "hidden");
    assert.equal(failed.getAttribute("aria-hidden"), "true");
    assert.equal(h.controller.getState().status, "unavailable");
    assert.equal(h.controller.getState().errors, count);
    assert.equal(h.controller.getState().active, true);
    layer.fire("load");
    assert.equal(h.controller.getState().status, "unavailable");
    assert.equal(h.controller.getState().errors, count);
  }
  assert.equal(h.layers.length, 1, "errors and load events must not create retries");
});

test("the third error stops the selected layer without an automatic replacement", () => {
  const h = harness();
  h.controller.select("streets");
  const layer = h.layers[0];
  const errorCallbacks = layer.captured("tileerror");
  const loadCallbacks = layer.captured("load");
  assert.ok(errorCallbacks.length && loadCallbacks.length, "capture real registered handlers");
  for (let index = 0; index < 3; index += 1) layer.fire("tileerror", { tile: tile() });
  assert.equal(h.controller.getState().status, "stopped");
  assert.equal(h.controller.getState().provider, "streets");
  assert.equal(h.controller.getState().errors, 3);
  assert.equal(h.controller.getState().active, false);
  assert.equal(h.attached.size, 0);
  assert.equal(h.layers.length, 1);
  const stable = h.controller.getState();
  late(errorCallbacks, { tile: tile() });
  late(loadCallbacks);
  assert.deepEqual(h.controller.getState(), stable, "late responses from the stopped layer are inert");
});

test("only a manual retry creates a fresh layer and clears that provider's errors", () => {
  const h = harness();
  h.controller.select("streets");
  const previous = h.layers[0];
  for (let index = 0; index < 3; index += 1) previous.fire("tileerror", { tile: tile() });
  assert.equal(h.controller.getState().status, "stopped");
  const errors = previous.captured("tileerror");
  const loads = previous.captured("load");
  h.controller.retry();
  assert.equal(h.layers.length, 2);
  assert.notEqual(h.layers[1], previous);
  assert.equal(h.attached.has(previous), false);
  assert.equal(h.controller.getState().provider, "streets");
  assert.equal(h.controller.getState().status, "loading");
  assert.equal(h.controller.getState().errors, 0);
  const pending = h.controller.getState();
  late(errors, { tile: tile() });
  late(loads);
  assert.deepEqual(h.controller.getState(), pending, "same-provider stale generation cannot mark retry available or failed");
  h.layers[1].fire("load");
  assert.equal(h.controller.getState().status, "available");
});

test("turning the background off rejects captured callbacks from the former layer", () => {
  const h = harness();
  h.controller.select("streets");
  const layer = h.layers[0];
  const errors = layer.captured("tileerror");
  const loads = layer.captured("load");
  h.controller.select("none");
  assert.equal(h.attached.size, 0);
  assert.equal(h.controller.getState().provider, "none");
  assert.equal(h.controller.getState().status, "none");
  assert.equal(h.controller.getState().active, false);
  const off = h.controller.getState();
  const notifications = h.states.length;
  late(errors, { tile: tile() });
  late(loads);
  assert.deepEqual(h.controller.getState(), off);
  assert.equal(h.states.length, notifications, "stale events must not announce false failures after off");
});

test("switching providers ignores old load and error callbacks rather than resetting the new state", () => {
  const h = harness();
  h.controller.select("streets");
  const old = h.layers[0];
  const errors = old.captured("tileerror");
  const loads = old.captured("load");
  h.controller.select("satellite");
  const replacement = h.layers[1];
  assert.equal(h.attached.has(old), false);
  assert.equal(h.attached.has(replacement), true);
  const pending = h.controller.getState();
  late(errors, { tile: tile() });
  late(loads);
  assert.deepEqual(h.controller.getState(), pending);
  replacement.fire("tileerror", { tile: tile() });
  assert.equal(h.controller.getState().provider, "satellite");
  assert.equal(h.controller.getState().errors, 1);
  assert.equal(h.controller.getState().status, "unavailable");
});

test("turning a stopped layer off then selecting again cannot revive its callbacks", () => {
  const h = harness();
  h.controller.select("streets");
  const old = h.layers[0];
  const errors = old.captured("tileerror");
  const loads = old.captured("load");
  for (let index = 0; index < 3; index += 1) old.fire("tileerror", { tile: tile() });
  h.controller.select("none");
  h.controller.select("streets");
  const fresh = h.controller.getState();
  late(errors, { tile: tile() });
  late(loads);
  assert.deepEqual(h.controller.getState(), fresh);
  assert.equal(h.layers.length, 2);
  assert.equal(h.controller.getState().errors, 0);
});

test("invalid provider values cannot create layers or change an active selection", () => {
  const h = harness();
  h.controller.select("streets");
  const selected = h.controller.getState();
  const notifications = h.states.length;
  for (const value of ["road", "Streets", "__proto__", "", null, undefined, {}]) {
    assert.equal(h.controller.select(value), false);
    assert.deepEqual(h.controller.getState(), selected);
  }
  assert.equal(h.layers.length, 1);
  assert.equal(h.states.length, notifications);
});
