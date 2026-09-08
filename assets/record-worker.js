"use strict";

importScripts("./csv-parser.js?v=20260908-display-v2");

let busy = false;

function safeRequestId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && value.length <= 64) return value;
  return null;
}

function safeError(error) {
  const result = {
    code: typeof error?.code === "string" ? error.code : "PARSE_FAILED",
    message: error instanceof CityChatCsv.CsvValidationError
      ? error.message
      : "ไม่สามารถตรวจสอบไฟล์ได้"
  };
  if (Number.isInteger(error?.rowNumber)) result.rowNumber = error.rowNumber;
  if (typeof error?.columnName === "string") result.columnName = error.columnName;
  return result;
}

self.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || data.type !== "parse") return;

  const requestId = safeRequestId(data.requestId);
  if (busy) {
    self.postMessage({
      type: "error",
      requestId,
      error: { code: "WORKER_BUSY", message: "ระบบกำลังตรวจไฟล์อีกชุดอยู่" }
    });
    return;
  }

  busy = true;
  try {
    const result = await CityChatCsv.parseVerifiedFile(data.file, (progress) => {
      self.postMessage({ type: "progress", requestId, progress });
    });
    self.postMessage({
      type: "success",
      requestId,
      rows: result.rows,
      summary: result.summary
    });
  } catch (error) {
    self.postMessage({ type: "error", requestId, error: safeError(error) });
  } finally {
    busy = false;
  }
});
