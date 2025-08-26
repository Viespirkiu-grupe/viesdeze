import dotenv from "dotenv";
import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import https from "https";

dotenv.config({ quiet: true });

let env = {
    ...process.env,
    S3: process.env.S3 === "true" || process.env.S3 === "TRUE",
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY,
    S3_REGION: process.env.S3_REGION || "us-east-1",
    S3_BUCKET: process.env.S3_BUCKET || "viespirkiai",
};

const agent = new https.Agent({
    maxSockets: 250,
});

env.s3Client = env.S3
    ? new S3Client({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          credentials: {
              accessKeyId: env.S3_ACCESS_KEY,
              secretAccessKey: env.S3_SECRET_KEY,
          },
          requestHandler: new NodeHttpHandler({
              httpsAgent: agent,
          }),
      })
    : null;

export default env;
