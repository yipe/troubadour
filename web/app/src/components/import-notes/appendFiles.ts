/** Adds each file to `text` under a `# <file name>` heading, so one import can carry a whole folder of notes. */
export async function appendFiles(text: string, files: File[]): Promise<string> {
  const parts = await Promise.all(files.map(async (f) => `# ${f.name}\n\n${(await f.text()).trim()}`))
  return [text.trim(), ...parts].filter(Boolean).join("\n\n")
}
