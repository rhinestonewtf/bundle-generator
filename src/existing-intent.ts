import { getReplayParams } from "./cli";
import { config } from "dotenv";
import { processIntent } from "./main";
import * as fs from "fs";
import * as path from "path";

config();

export const main = async () => {
  const replayParams = await getReplayParams();

  let intentsToReplay;
  if (replayParams.isAll) {
    intentsToReplay = fs
      .readdirSync("intents")
      .filter((file) => file.endsWith(".json") && /^\d+\./.test(file))
      .map((file) => file);
  } else {
    intentsToReplay = replayParams.intentsToReplay;
  }

  const intents = intentsToReplay.map((file) => {
    const filePath = path.join("intents", file);
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  });

  if (replayParams.isSequential) {
    for (const intent of intents) {
      await processIntent(intent);
    }
  } else {
    await Promise.all(intents.map((intent) => processIntent(intent)));
  }
};

main();
