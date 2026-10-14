import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { assertSchematic, fetchGzipText, isHiddenByDefault, stringToColor, toVoxels } from "../site/assets/schematicVoxels.js";

test("meta-filler is hidden by default, with or without a domain prefix, and nothing else is", () => {
  assert.ok(isHiddenByDefault("game:meta-filler"));
  assert.ok(isHiddenByDefault("meta-filler"));
  assert.ok(isHiddenByDefault("betterruins:meta-filler"));
  for (const code of ["game:meta-underground", "game:meta-pathway", "game:meta-fillerx", "game:rock-granite", "game:metalblock-new-plain-lead", "game:meta-filler-extra"]) {
    assert.ok(!isHiddenByDefault(code), code);
  }
});

test("toVoxels unpacks x/z/y from the packed index and maps BlockIds through BlockCodes", () => {
  const pack = (x: number, y: number, z: number) => x | (z << 10) | (y << 20);
  const voxels = toVoxels({
    Indices: [pack(1, 2, 3), pack(1023, 1023, 1023), pack(0, 0, 0)],
    BlockIds: [5, 6, 99],
    BlockCodes: { "5": "game:rock-granite", "6": "game:meta-filler" },
  });
  assert.deepEqual(voxels.map((v) => [v.x, v.y, v.z, v.code]), [
    [1, 2, 3, "game:rock-granite"],
    [1023, 1023, 1023, "game:meta-filler"],
    [0, 0, 0, "unknown"], // an id missing from BlockCodes
  ]);
});

test("assertSchematic rejects objects without the voxel fields", () => {
  assert.throws(() => assertSchematic({}), /Not a Vintage Story schematic/);
  assert.throws(() => assertSchematic({ Indices: [], BlockIds: [] }), /BlockCodes/);
  assert.doesNotThrow(() => assertSchematic({ Indices: [], BlockIds: [], BlockCodes: {} }));
});

test("stringToColor is stable per code", () => {
  assert.equal(stringToColor("game:rock-granite"), stringToColor("game:rock-granite"));
  assert.notEqual(stringToColor("game:rock-granite"), stringToColor("game:rock-basalt"));
});

test("fetchGzipText unpacks a served .json.gz and reports the download length", async () => {
  const body = JSON.stringify({ SizeX: 1, Indices: [1, 2, 3] });
  const gz = gzipSync(body);
  const server = http.createServer((req, res) => {
    if (req.url === "/ok.json.gz") {
      res.setHeader("content-length", gz.length);
      res.end(gz);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    let length = -1;
    assert.equal(await fetchGzipText(`${base}/ok.json.gz`, (n: number) => (length = n)), body);
    assert.equal(length, gz.length);
    await assert.rejects(fetchGzipText(`${base}/missing.json.gz`), /HTTP 404/);
  } finally {
    server.close();
  }
});
