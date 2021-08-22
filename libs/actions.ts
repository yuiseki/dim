import { Colors, ensureDir, ensureFile, existsSync } from "../deps.ts";
import {
  DEFAULT_DATAFILES_PATH,
  DEFAULT_DIM_FILE_PATH,
  DEFAULT_DIM_LOCK_FILE_PATH,
  DIM_LOCK_VERSION,
} from "./consts.ts";
import { Downloader } from "./downloader.ts";
import { DimFileAccessor, DimLockFileAccessor } from "./accessor.ts";
import { Content, DimJSON, DimLockJSON, LockContent } from "./types.ts";
import { Encoder } from "./encoder.ts";

const initDimFile = async () => {
  const dimData: DimJSON = { contents: [] };
  await ensureFile(DEFAULT_DIM_FILE_PATH);
  return await Deno.writeTextFile(
    DEFAULT_DIM_FILE_PATH,
    JSON.stringify(dimData, null, 2),
  );
};

const initDimLockFile = async () => {
  const dimLockData: DimLockJSON = {
    lockFileVersion: DIM_LOCK_VERSION,
    contents: [],
  };
  await ensureFile(DEFAULT_DIM_LOCK_FILE_PATH);
  return await Deno.writeTextFile(
    DEFAULT_DIM_LOCK_FILE_PATH,
    JSON.stringify(dimLockData, null, 2),
  );
};

const createDataFilesDir = async () => {
  await ensureDir(DEFAULT_DATAFILES_PATH);
};

const installFromURL = async (
  url: string,
  preprocess?: string[],
  isUpdate = false,
) => {
  const dimLockFileAccessor = new DimLockFileAccessor();
  const isInstalled = dimLockFileAccessor.getContents().some((
    lockContent,
  ) => lockContent.url === url);
  if (isInstalled && !isUpdate) {
    console.log("The url have already been installed.");
    Deno.exit(0);
  }
  return await Promise.all([
    new Downloader().download(new URL(url)),
    new DimFileAccessor().addContent(url, url, preprocess || []),
  ]);
};

const installFromDimFile = async (isUpdate = false) => {
  let contents = new DimFileAccessor().getContents();
  if (contents.length == 0) {
    console.log("No contents.\nYou should run a 'dim install <data url>'. ");
    return;
  }
  const dimLockFileAccessor = new DimLockFileAccessor();
  if (!isUpdate) {
    const isNotInstalled = (content: Content) =>
      dimLockFileAccessor.getContents().every((lockContent) =>
        lockContent.url !== content.url
      );
    contents = contents.filter(isNotInstalled);
  }
  const downloadList = contents.map((content) => {
    return new Promise<LockContent>((resolve) => {
      new Downloader().download(new URL(content.url)).then((result) => {
        console.log(
          Colors.green(`Installed ${content.url}`),
          `\nFile path:`,
          Colors.yellow(result.fullPath),
        );
        console.log();
        resolve({
          url: content.url,
          path: result.fullPath,
          name: content.name,
          preprocesses: content.preprocesses,
          lastUpdated: new Date(),
        });
      });
    });
  });
  return await Promise.all(downloadList);
};
const executePreprocess = (preprocess: string[], targetPath: string) => {
  preprocess.forEach((p) => {
    if (p.startsWith("encoding-")) {
      const encodingTo = p.replace("encoding-", "").toUpperCase();
      new Encoder().encodeFile(targetPath, encodingTo);
      console.log("Converted encoding to", encodingTo);
    }
  });
};

export class InitAction {
  async execute(options: any) {
    await Promise.all([
      createDataFilesDir,
      initDimFile,
      initDimLockFile,
    ]);
    console.log(Colors.green("Initialized the project for the dim."));
  }
}

export class InstallAction {
  async execute(
    options: { preprocess?: [string] },
    url: string | undefined,
  ) {
    await createDataFilesDir();
    if (!existsSync(DEFAULT_DIM_LOCK_FILE_PATH)) {
      await initDimLockFile();
    }

    if (url !== undefined) {
      const results = await installFromURL(url, options.preprocess).catch(
        (error) => {
          console.error(
            Colors.red("Failed to install."),
            Colors.red(error.message),
          );
          Deno.exit(0);
        },
      );
      const fullPath = results[0].fullPath;
      const lockContent: LockContent = {
        url: url,
        path: fullPath,
        name: url,
        preprocesses: options.preprocess || [],
        lastUpdated: new Date(),
      };
      // Encoding as a preprocess.
      if (options.preprocess !== undefined) {
        executePreprocess(options.preprocess, fullPath);
      }
      await new DimLockFileAccessor().addContent(lockContent);
      console.log(
        Colors.green(`Installed ${url}.`),
        `\nFile path:`,
        Colors.yellow(fullPath),
      );
    } else {
      const lockContentList = await installFromDimFile().catch((error) => {
        console.error(
          Colors.red("Failed to install."),
          Colors.red(error.message),
        );
        Deno.exit(0);
      });
      if (lockContentList !== undefined) {
        await new DimLockFileAccessor().addContents(lockContentList);
        if (lockContentList.length != 0) {
          console.log(
            Colors.green(`Successfully installed.`),
          );
        } else {
          console.log("All contents have already been installed.");
        }
      }
    }
  }
}

export class UninstallAction {
  async execute(options: any, url: string) {
    const isRemovedDimFile = await new DimFileAccessor().removeContent(url);
    if (isRemovedDimFile) {
      console.log(
        Colors.green("Removed a content from the dim.json."),
      );
    } else {
      console.log(
        Colors.red("Faild to remove. Not Found a content in the dim.json."),
      );
    }
    const dimLockFileAccessor = await new DimLockFileAccessor();
    const targetContent = dimLockFileAccessor.getContents().find((c) =>
      c.url === url
    );
    const isRemovedDimLockFile = await dimLockFileAccessor.removeContent(url);
    if (isRemovedDimLockFile) {
      console.log(
        Colors.green("Removed a content from the dim-lock.json."),
      );
    } else {
      console.log(
        Colors.red(
          "Faild to remove. Not Found a content in the dim-lock.json.",
        ),
      );
    }
    if (targetContent !== undefined) {
      if (existsSync(targetContent.path)) {
        await Deno.remove(targetContent.path);
        console.log(
          Colors.green(`Removed a file '${targetContent.path}'.`),
        );
      }
      // TODO: Remove an empty direcotory
    }
  }
}

export class ListAction {
  execute(options: any): void {
    const contents = new DimLockFileAccessor().getContents();
    contents.forEach((content) => {
      console.log(
        content.name,
      );
      console.log(
        "  - URL:      ",
        Colors.green(content.url),
      );
      console.log(
        "  - File path:",
        Colors.green(content.path),
      );
      console.log();
    });
  }
}

export class UpdateAction {
  async execute(options: { preprocess?: string[] }, url: string | undefined) {
    await createDataFilesDir();
    if (!existsSync(DEFAULT_DIM_LOCK_FILE_PATH)) {
      await initDimLockFile();
    }

    if (url !== undefined) {
      const results = await installFromURL(url, options.preprocess, true).catch(
        (error) => {
          console.error(
            Colors.red("Failed to update."),
            Colors.red(error.message),
          );
          Deno.exit(0);
        },
      );
      const fullPath = results[0].fullPath;
      const lockContent: LockContent = {
        url: url,
        path: fullPath,
        name: url,
        preprocesses: options.preprocess || [],
        lastUpdated: new Date(),
      };
      // Encoding as a preprocess.
      if (options.preprocess !== undefined) {
        executePreprocess(options.preprocess, fullPath);
      }
      await new DimLockFileAccessor().addContent(lockContent);
      console.log(
        Colors.green(`Updated ${url}.`),
        `\nFile path:`,
        Colors.yellow(fullPath),
      );
    } else {
      const lockContentList = await installFromDimFile(true).catch((error) => {
        console.error(
          Colors.red("Failed to update."),
          Colors.red(error.message),
        );
        Deno.exit(0);
      });
      if (lockContentList !== undefined) {
        await new DimLockFileAccessor().addContents(lockContentList);
      }
      console.log(
        Colors.green(`Successfully Updated.`),
      );
    }
  }
}
