import fs from "fs";
import https from "https";
import { createGunzip } from "zlib"; // Node.js built-in for gzip
import tar from "tar-stream";
import Stream from "stream";
import { TradeListSchema, TraderTypeSchema, VsLanguageLutSchema, VsServer } from "@/utils/schema";
import TradeListTable from "@/components/TradeListTable";
import Link from 'next/link'
import type { Metadata } from 'next';
import { tradesRoute } from "../routes";

export const metadata: Metadata = {
  title: tradesRoute.name,
  description: tradesRoute.description,
  
};

async function cacheDownload(url: string, cacheFile: string): Promise<void> {
  if (fs.existsSync(cacheFile)) {
    console.log(`Cache file ${cacheFile} already exists.`);
    return;
  }

  console.log(`Downloading ${url} to ${cacheFile}...`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(cacheFile);
    const request = https.get(url, function (response) {
      const { errored } = response;
      if (errored) {
        file.close();
        fs.unlink(cacheFile, () => { }); // Delete the incomplete file
        return reject(new Error('Download request errored'));
      }

      response.pipe(file);

      file.on('finish', function () {
        file.close();
        console.log('Download finished.');
        resolve();
      });

      file.on('error', function (err) {
        file.close();
        fs.unlink(cacheFile, () => { }); // Delete the incomplete file
        console.error('File write error:', err);
        reject(err);
      });
    });

    request.on('error', function (err) {
      console.error('HTTPS request error:', err);
      reject(err);
    });
  });
}

async function cacheDownloadVintageStory(serverBranch: string, serverVersion: string, cacheFile: string) {
  const url = `https://cdn.vintagestory.at/gamefiles/${serverBranch}/vs_server_linux-x64_${serverVersion}.tar.gz`;
  return cacheDownload(url, cacheFile);
}

type VsServerContext = {
  header: tar.Headers,
  stream: Stream.PassThrough,
  callback: (error?: unknown) => void,
  vsServer: VsServer,
}

function parseVsTradeListFile({ header, stream, callback, vsServer }: VsServerContext) {
  let fileContent = '';
  stream.on('data', function (chunk) {
    fileContent += chunk.toString();
  })

  stream.on('end', async function () {
    try {
      const rawResult = JSON.parse(fileContent);
      const result = await TradeListSchema.safeParseAsync(rawResult);
      if (result.success) {
        const filenameNoExtension = header.name.substring(tradeListPathPrefix.length, header.name.length - ".json".length);
        const [traderTypeRaw, traderCode] = filenameNoExtension.split("-");

        vsServer.assets.survival.config.tradelists.push({
          filePath: header.name,
          traderCode: traderCode,
          traderType: TraderTypeSchema.parse(traderTypeRaw),
          ...result.data,
        });
      } else {
        console.error(`Failed to parse: ${header.name}`);
        console.error(result.error);
      }

    } catch (e) {
      console.error(`Failed to parse: ${header.name}`);
      console.error(e);
    }
    callback(); // ready for next entry
  });
  stream.resume(); // just auto drain the stream
}

function parseLanguageFile({ header, stream, callback, vsServer }: VsServerContext) {
  const lang = header.name.substring(langPathPrefix.length + 1, header.name.length - ".json".length);
  let fileContent = '';
  stream.on('data', function (chunk) {
    fileContent += chunk.toString();
  })

  stream.on('end', async function () {
    const { lut } = vsServer.assets.game.lang;
    try {
      const rawResult = JSON.parse(fileContent);
      const result = await VsLanguageLutSchema.safeParseAsync(rawResult);
      if (result.success) {
        lut.set(lang, result.data);
      } else {
        console.error(`Failed to parse: ${header.name}`);
        console.error(result.error);
      }
    } catch (e) {
      console.error(`Failed to parse: ${header.name}`);
      console.error(e);
    }
    callback(); // ready for next entry
  });
  stream.resume(); // just auto drain the stream
}

function noOpVsFileParse({ stream, callback }: VsServerContext) {
  stream.on('end', async function () {
    callback(); // ready for next entry
  });
  stream.resume(); // just auto drain the stream
}

const tradeListPathPrefix = "assets/survival/config/tradelists/";
const langPathPrefix = "assets/game/lang";

function parseVsServerFile(context: VsServerContext) {
  const { header } = context;
  if (header.name.startsWith(tradeListPathPrefix) && header.name.endsWith(".json")) {
    parseVsTradeListFile(context);
  }
  else if(header.name === `${langPathPrefix}/languages.json`) {
    noOpVsFileParse(context);
  }
  else if(header.name === `${langPathPrefix}/ro.json`) { 
    noOpVsFileParse(context);
  }
  else if (header.name.startsWith(langPathPrefix) && header.name.endsWith(".json")) {
    parseLanguageFile(context);
  }
  else {
    noOpVsFileParse(context);
  }
}

async function parseVsServer(serverBranch: string, serverVersion: string, cacheFile: string): Promise<VsServer> {
  await cacheDownloadVintageStory(serverBranch, serverVersion, cacheFile);

  const vsServer: VsServer = {
    serverBranch: serverBranch,
    serverVersion: serverVersion,
    assets: {
      game: {
        lang: {
          lut: new Map(),
        },
      },
      survival: {
        config: {
          tradelists: [],
        }
      }
    }
  };

  return new Promise((resolve, reject) => {
    const extract = tar.extract();

    extract.on('entry', function (header, stream, callback) {
      parseVsServerFile({ header, stream, callback, vsServer });
    });

    extract.on('finish', function () {
      console.log("Tar extraction finished.");
      resolve(vsServer);
    });

    const readStream = fs.createReadStream(cacheFile);
    const gunzipStream = createGunzip();

    readStream.on('error', (err) => {
      console.error("Error creating read stream:", err);
      reject(err);
    });

    gunzipStream.on('error', (err) => {
      console.error("Error during gunzip:", err);
      reject(err);
    });

    readStream
      .pipe(gunzipStream) // Decompress gzip first
      .pipe(extract); // Then pipe the decompressed data to the tar extractor
  });
}

export default async function Home() {
  const serverBranch = "stable";
  const serverVersion = "1.20.12";
  const cacheFile = "vs_server.tar.gz";

  const vsServer = await parseVsServer(serverBranch, serverVersion, cacheFile);

  return (
    <div>
      <h1>Vintage Story Trade Price Guide</h1>
      <Link href="/">Go Back</Link>
      <h2>Build Information</h2>
      <ul>
        <li>Build Date: {new Date().toISOString()}</li>
        <li>Vintage Story Branch: {serverBranch}</li>
        <li>Vintage Story Version: {serverVersion}</li>
      </ul>
      <h2>Trades</h2>
      <p>The trades are listed below:</p>
      <TradeListTable lang={"en"} vsServer={vsServer} />
    </div>
  );
}
