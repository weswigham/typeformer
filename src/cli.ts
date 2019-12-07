#!/usr/bin/env node
import { transformProjectInPlace } from ".";
import { existsSync } from "fs";
import { resolve } from "path";

const fileName = process.argv[2];
if (!fileName || !existsSync(fileName)) {
    console.error(`File ${fileName} not found - provide a path to the root project tsconfig.`);
    process.exit(1);
}
const configPath = resolve(process.cwd(), fileName);
transformProjectInPlace(configPath);