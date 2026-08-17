import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders the signed payload as a scannable QR, regenerated whenever it changes. */
export function QrImage({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#0c0a09', light: '#ffffff' } })
      .then((url) => { if (active) setDataUrl(url); })
      .catch(() => { if (active) setDataUrl(null); });
    return () => { active = false; };
  }, [value, size]);

  if (dataUrl === null) {
    return <div className="animate-pulse rounded-lg bg-stone-800" style={{ width: size, height: size }} aria-hidden />;
  }
  return <img src={dataUrl} alt="QR code do ingresso" width={size} height={size} className="rounded-lg" />;
}
