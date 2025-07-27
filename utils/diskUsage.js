import fsp from "fs/promises";

let totalSize = 0;
const USAGE_FILE = "./usage.json";

/**
 * Gets the current total disk usage in bytes.
 * @returns {number} - The total size in bytes
 */
export function getUsage(){
    return totalSize;
}

/**
 * Sets the total disk usage to a specific value.
 * @param {number} size - The size in bytes to set
 */
export async function setUsage(size) {
    totalSize = size;
    await saveUsage().catch(err => console.error("Failed to save usage:", err));
}

/**
 * Loads disk usage from the usage.json file.
 * If the file doesn't exist, initializes totalSize to 0.
 */
export async function loadUsage() {
    try {
        const data = JSON.parse(await fsp.readFile(USAGE_FILE, "utf8"));
        totalSize = data.totalSize || 0;
        console.log(`Loaded usage: ${totalSize} bytes`);
    } catch {
        totalSize = 0;
        console.log("No existing usage.json, starting fresh.");
    }
}

/**
 * Saves the current totalSize to the usage.json file.
 */
export async function saveUsage() {
    await fsp.writeFile(USAGE_FILE, JSON.stringify({ totalSize }));
}

/**
 * Recursively calculates the total size of all files in the storage directory.
 * Updates totalSize and saves it to the usage.json file.
 */
export async function calculateTotalSize() {
    let size = 0;
    const walk = async (dir) => {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else {
                const stat = await fsp.stat(fullPath);
                size += stat.size;
            }
        }
    };
    try {
        await walk(STORAGE_PATH);
        totalSize = size;
        await saveUsage();
        console.log(`Recalculated total size: ${size} bytes`);
    } catch (err) {
        console.error("Failed to recalculate storage:", err);
    }
}