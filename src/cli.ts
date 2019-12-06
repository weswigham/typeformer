#!/usr/bin/env node
import { transformProjectFromNamespacesToModules } from ".";
import { existsSync } from "fs";
import { resolve, dirname } from "path";

const fileName = process.argv[2];
if (!fileName || !existsSync(fileName)) {
    console.error(`File ${fileName} not found - provide a path to the root project tsconfig.`);
    process.exit(1);
}
const configPath = resolve(process.cwd(), fileName);
transformProjectFromNamespacesToModules(configPath, dirname(configPath)+"-new");