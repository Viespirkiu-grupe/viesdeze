import path from "path";
import dotenv from "dotenv";

dotenv.config();

const STORAGE_PATH = process.env.STORAGE_PATH || "./storage";

/**
 * Shards a path by making the first two characters of the filename a subdirectory.
 * @param {String} filename 
 * @returns {String} - The path to the file in the sharded storage structure
 */
export default function shardPath(filename) {
	const shard = filename.slice(0, 2);
	return path.join(STORAGE_PATH, shard, filename);
}