import { config } from "dotenv";
config();

import { getReplayParams } from "./cli.js";
import { processIntent } from "./main.js";
import * as fs from "fs";
import * as path from "path";

export const main = async () => {
  const replayParams = await getReplayParams();

  let intentsToReplay;
  if (replayParams.isAll) {
    intentsToReplay = fs
      .readdirSync("intents")
      .filter((file) => file.endsWith(".json"))
      .map((file) => file);
  } else {
    intentsToReplay = replayParams.intentsToReplay;
  }
  const intents = intentsToReplay.flatMap((file) => {
    const filePath = path.join("intents", file);
    const data = fs.readFileSync(filePath, "utf-8");
    const parsedData = JSON.parse(data);
    return parsedData.intentList ? parsedData.intentList : [parsedData];
  });

  for (const intent of intents) {
    if (!replayParams.asyncMode) {
      await processIntent(intent);
    } else {
      processIntent(intent);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, replayParams.msBetweenBundles)
    );
  }
};

main();
