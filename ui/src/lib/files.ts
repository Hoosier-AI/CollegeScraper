// Handing a picture to the phone's share sheet from inside the app (a web view cannot share a file it fetched, and a
// download link there just opens the image). The website keeps its own share and download.
import { isNative } from './platform';

const toBase64 = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

/** App only: write the file to the cache folder and open the share sheet with it. */
export async function shareFile(blob: Blob, name: string, title: string, text?: string): Promise<void> {
  if (!isNative) return;
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const saved = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
  try { await Share.share({ title, text, files: [saved.uri] }); } catch { /* closed the sheet */ }
}

/** A small tap you can feel: on following something, on a refresh. Nothing on the website. */
export async function tick(): Promise<void> {
  if (!isNative) return;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  await Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}
