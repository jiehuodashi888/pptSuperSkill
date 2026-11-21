import { frameworkVersion } from "../runtime/src/index.js";
import assert from "node:assert/strict";

assert.match(frameworkVersion, /^0\.1\.0$/);
