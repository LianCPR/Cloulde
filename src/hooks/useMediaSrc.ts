import { useEffect, useRef, useState } from "react";
import type { Album, Photo } from "@/types";
import {
  mediaUrlCache,
  resolveAlbumCover,
  resolveDisplayPath,
  type MediaPurpose,
} from "@/services/photoService";

export interface MediaSrcState {
  src: string | null;
  loading: boolean;
  /** Định dạng không xem trước được (RAW/TIFF/HEIC trên trình duyệt lạ). */
  unsupported: boolean;
}

export type SrcResolver = (
  photo: Photo,
  purpose: MediaPurpose,
) => Promise<{ url: string; release: () => void }>;

const defaultResolver: SrcResolver = async (photo, purpose) => {
  if (purpose === "original") {
    const url = await mediaUrlCache.acquire("original", photo.storagePath);
    return { url, release: () => mediaUrlCache.release("original", photo.storagePath) };
  }
  const target = resolveDisplayPath(photo);
  if (!target) throw new Error("unsupported-format");
  const url = await mediaUrlCache.acquire(target.kind, target.path);
  return { url, release: () => mediaUrlCache.release(target.kind, target.path) };
};

/**
 * Lấy URL hiển thị cho một ảnh và TỰ ĐỘNG thu hồi khi component gỡ bỏ.
 * Nhờ vậy object URL của backend cục bộ không bao giờ rò rỉ.
 */
export function useMediaSrc(
  photo: Photo | null | undefined,
  purpose: MediaPurpose = "thumbnail",
  resolver: SrcResolver = defaultResolver,
): MediaSrcState {
  const [state, setState] = useState<MediaSrcState>({
    src: null,
    loading: Boolean(photo),
    unsupported: false,
  });
  const releaseRef = useRef<(() => void) | null>(null);
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  useEffect(() => {
    let active = true;
    releaseRef.current?.();
    releaseRef.current = null;

    if (!photo) {
      setState({ src: null, loading: false, unsupported: false });
      return;
    }

    setState({ src: null, loading: true, unsupported: false });

    resolverRef
      .current(photo, purpose)
      .then(({ url, release }) => {
        if (!active) {
          release();
          return;
        }
        releaseRef.current = release;
        setState({ src: url, loading: false, unsupported: false });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          src: null,
          loading: false,
          unsupported: error instanceof Error && error.message === "unsupported-format",
        });
      });

    return () => {
      active = false;
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [photo, purpose]);

  return state;
}

/** Ảnh bìa album. */
export function useAlbumCoverSrc(album: Album | null | undefined): MediaSrcState {
  const [state, setState] = useState<MediaSrcState>({
    src: null,
    loading: Boolean(album),
    unsupported: false,
  });

  useEffect(() => {
    let active = true;
    const target = album ? resolveAlbumCover(album) : null;
    if (!target) {
      setState({ src: null, loading: false, unsupported: Boolean(album && !album.coverPhotoId) });
      return;
    }
    setState({ src: null, loading: true, unsupported: false });
    mediaUrlCache
      .acquire(target.kind, target.path)
      .then((url) => {
        if (!active) {
          mediaUrlCache.release(target.kind, target.path);
          return;
        }
        setState({ src: url, loading: false, unsupported: false });
      })
      .catch(() => {
        if (active) setState({ src: null, loading: false, unsupported: true });
      });

    return () => {
      active = false;
      mediaUrlCache.release(target.kind, target.path);
    };
  }, [album]);

  return state;
}
