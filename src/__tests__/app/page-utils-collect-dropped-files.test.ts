import { describe, expect, it, vi } from "vitest";

import { collectDroppedFiles } from "@/app/page-components/page-utils";

interface MockEntry {
  isFile?: boolean;
  isDirectory?: boolean;
  file?: (resolve: (file: File | null) => void, reject: () => void) => void;
  createReader?: () => { readEntries: (resolve: (entries: MockEntry[]) => void, reject?: () => void) => void };
}

function makeFileEntry(name: string, content = ""): MockEntry {
  return {
    isFile: true,
    isDirectory: false,
    file: (resolve) => {
      const file = new File([content], name);
      resolve(file);
    },
  };
}

function makeDirEntry(children: MockEntry[]): MockEntry {
  let served = false;
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (resolve) => {
        if (served) {
          resolve([]);
        } else {
          served = true;
          resolve(children);
        }
      },
    }),
  };
}

function makeDataTransferItems(entries: MockEntry[]): DataTransferItemList {
  const items = entries.map((entry) => ({
    webkitGetAsEntry: () => entry as unknown as FileSystemEntry,
  }));
  return Object.assign(items, { length: items.length }) as unknown as DataTransferItemList;
}

describe("collectDroppedFiles", () => {
  it("returns [] when items don't expose webkitGetAsEntry", async () => {
    const fakeItems = Object.assign([{}], { length: 1 }) as unknown as DataTransferItemList;
    expect(await collectDroppedFiles(fakeItems)).toEqual([]);
  });

  it("collects a single dropped file", async () => {
    const items = makeDataTransferItems([makeFileEntry("a.png", "x")]);
    const collected = await collectDroppedFiles(items);
    expect(collected).toHaveLength(1);
    expect(collected[0].name).toBe("a.png");
  });

  it("walks a directory and collects every file inside", async () => {
    const items = makeDataTransferItems([
      makeDirEntry([
        makeFileEntry("first.pdf"),
        makeDirEntry([makeFileEntry("nested.png")]),
        makeFileEntry("second.jpg"),
      ]),
    ]);
    const collected = await collectDroppedFiles(items);
    const names = collected.map((f) => f.name).sort();
    expect(names).toEqual(["first.pdf", "nested.png", "second.jpg"]);
  });

  it("ignores entries whose .file callback rejects", async () => {
    const broken: MockEntry = {
      isFile: true,
      file: (_resolve, reject) => reject(),
    };
    const items = makeDataTransferItems([broken, makeFileEntry("ok.png")]);
    const collected = await collectDroppedFiles(items);
    expect(collected.map((f) => f.name)).toEqual(["ok.png"]);
  });

  it("ignores entries that are neither file nor directory", async () => {
    vi.stubGlobal("File", File);
    const weird: MockEntry = { isFile: false, isDirectory: false };
    const items = makeDataTransferItems([weird, makeFileEntry("real.png")]);
    const collected = await collectDroppedFiles(items);
    expect(collected.map((f) => f.name)).toEqual(["real.png"]);
  });
});
