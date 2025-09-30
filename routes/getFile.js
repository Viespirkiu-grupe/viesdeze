import { Router } from "express";
import shardPath from "../utils/shardPath.js";
import fsp from "fs/promises";
import fs from "fs";
import mime from "mime";
import generateCandidatePaths from "../utils/candidatePaths.js";
import env from "../utils/env.js";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3Client = env.s3Client;

const router = Router();

router.get("/file/:filename", async (req, res) => {
    const basePath = shardPath(req.params.filename);

    if (env.S3) {
        let Key = basePath;

        try {
            const candidates = generateCandidatePaths(basePath);
            let foundKey = false;
            let head;

            for (const testKey of candidates) {
                console.log("Testing key:", testKey);
                try {
                    head = await s3Client.send(
                        new HeadObjectCommand({
                            Bucket: env.S3_BUCKET,
                            Key: testKey,
                        }),
                    );
                    Key = testKey;
                    foundKey = true;
                    break;
                } catch (err) {}
            }

            if (!foundKey) {
                console.log("Actually didn't find");
                return res.status(404).json({ error: "File not found" });
            }

            const fileSize = head.ContentLength ?? 0;
            const contentType = mime.getType(Key) || "application/octet-stream";
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                if (start >= fileSize || end >= fileSize || start > end) {
                    return res
                        .status(416)
                        .set("Content-Range", `bytes */${fileSize}`)
                        .end();
                }

                const getCommand = new GetObjectCommand({
                    Bucket: env.S3_BUCKET,
                    Key,
                    Range: `bytes=${start}-${end}`,
                });
                const data = await s3Client.send(getCommand);

                res.status(206).set({
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Accept-Ranges": "bytes",
                    "Content-Length": end - start + 1,
                    "Content-Type": contentType,
                });

                data.Body.pipe(res);
            } else {
                const getCommand = new GetObjectCommand({
                    Bucket: env.S3_BUCKET,
                    Key,
                });
                const data = await s3Client.send(getCommand);

                res.status(200).set({
                    "Content-Length": fileSize,
                    "Content-Type": contentType,
                    "Accept-Ranges": "bytes",
                });

                data.Body.pipe(res);
            }
        } catch (err) {
            console.error(err);
            return res.status(404).json({ error: "File not found" });
        }
    } else {
        const candidates = generateCandidatePaths(basePath);
        let stat;
        let filePath;

        try {
            for (const candidate of candidates) {
                try {
                    stat = await fsp.stat(candidate);
                    filePath = candidate;
                    break;
                } catch (err) {
                    if (err.code !== "ENOENT") throw err;
                }
            }

            if (!stat) {
                return res.status(404).json({ error: "File not found" });
            }

            const fileSize = stat.size;
            const contentType =
                mime.getType(filePath) || "application/octet-stream";
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                if (start >= fileSize || end >= fileSize || start > end) {
                    return res
                        .status(416)
                        .set("Content-Range", `bytes */${fileSize}`)
                        .end();
                }

                res.status(206).set({
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Accept-Ranges": "bytes",
                    "Content-Length": end - start + 1,
                    "Content-Type": contentType,
                });

                fs.createReadStream(filePath, { start, end }).pipe(res);
            } else {
                res.status(200).set({
                    "Content-Length": fileSize,
                    "Content-Type": contentType,
                    "Accept-Ranges": "bytes",
                });

                fs.createReadStream(filePath).pipe(res);
            }
        } catch (err) {
            console.error(err);
            res.status(404).json({ error: "File not found" });
        }
    }
});

export default router;
