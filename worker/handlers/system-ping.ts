import { defineHandler, systemPing } from "../../src/server/jobs";

export const systemPingHandler = defineHandler(systemPing, async (payload, context) => {
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      level: "info",
      msg: "system.ping",
      id: context.jobId,
      message: payload.message,
    }),
  );
});
