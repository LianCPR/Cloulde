import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "motion/react";
import { Camera, Check, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { TextField, TextAreaField } from "@/components/ui/Field";
import { PhotoThumb } from "@/components/photos/PhotoThumb";
import type { Album, Photo } from "@/types";
import { useMediaSrc } from "@/hooks/useMediaSrc";
import { cn } from "@/lib/cn";

const albumSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Hãy đặt tên cho album.")
    .max(80, "Tên album tối đa 80 ký tự."),
  description: z
    .string()
    .trim()
    .max(500, "Mô tả tối đa 500 ký tự.")
    .optional()
    .or(z.literal("")),
});

export type AlbumFormValues = z.infer<typeof albumSchema>;

/** Hộp thoại tạo album mới. */
export function AlbumDialog({
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: { title: string; description: string | null }) => Promise<void>;
  submitting?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AlbumFormValues>({
    resolver: zodResolver(albumSchema),
    defaultValues: { title: "", description: "" },
  });

  useEffect(() => {
    if (open) reset({ title: "", description: "" });
  }, [open, reset]);

  const submit = handleSubmit(async (values) => {
    await onSubmit({
      title: values.title.trim(),
      description: values.description?.trim() || null,
    });
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tạo album mới"
      description="Album là nơi bạn nhóm những bộ ảnh cùng chủ đề — ví dụ “Đà Lạt 2026”."
      variant="sheet"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} onClick={() => void submit()}>
            Tạo album
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="Tên album"
          placeholder="Ví dụ: Đà Lạt — sương sớm"
          required
          error={errors.title?.message ?? null}
          data-autofocus
          {...register("title")}
        />
        <TextAreaField
          label="Mô tả (không bắt buộc)"
          placeholder="Vài dòng kể lại bối cảnh của bộ ảnh này…"
          error={errors.description?.message ?? null}
          {...register("description")}
        />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** Hộp thoại chỉnh sửa album, gồm cả chọn ảnh bìa. */
export function AlbumEditDialog({
  open,
  onClose,
  album,
  photos,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  open: boolean;
  onClose: () => void;
  album: Album;
  photos: Photo[];
  onSave: (values: {
    title: string;
    description: string | null;
    coverPhotoId: string | null;
  }) => Promise<void>;
  onDelete?: () => void;
  saving?: boolean;
  deleting?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AlbumFormValues>({
    resolver: zodResolver(albumSchema),
    defaultValues: { title: album.title, description: album.description ?? "" },
  });
  // Ảnh bìa được chọn bằng tham chiếu metadata, không sửa dữ liệu ảnh gốc.
  const [coverId, setCoverId] = useState<string | null>(album.coverPhotoId);

  useEffect(() => {
    if (open) {
      reset({ title: album.title, description: album.description ?? "" });
      setCoverId(album.coverPhotoId);
    }
  }, [album, open, reset, setCoverId]);

  const submit = handleSubmit(async (values) => {
    await onSave({
      title: values.title.trim(),
      description: values.description?.trim() || null,
      coverPhotoId: coverId,
    });
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Chỉnh sửa album"
      variant="sheet"
      size="lg"
      footer={
        <>
          {onDelete ? (
            <Button
              variant="danger"
              className="sm:mr-auto"
              loading={deleting}
              icon={<Trash2 className="size-4" aria-hidden />}
              onClick={onDelete}
            >
              Xoá album
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button loading={saving} onClick={() => void submit()}>
            Lưu thay đổi
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="Tên album"
          required
          error={errors.title?.message ?? null}
          {...register("title")}
        />
        <TextAreaField
          label="Mô tả"
          error={errors.description?.message ?? null}
          {...register("description")}
        />

        <fieldset>
          <legend className="text-[13px] font-medium text-ink">Ảnh bìa</legend>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            Chọn một ảnh làm bìa. Ảnh gốc không bị thay đổi — chỉ có tham chiếu được cập nhật.
          </p>
          {photos.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-line bg-blush/40 px-4 py-3 text-[12.5px] text-ink-soft">
              Album chưa có ảnh. Hãy tải ảnh lên trước khi chọn ảnh bìa.
            </p>
          ) : (
            <div className="mt-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-2xl border border-line bg-warm/60 p-2 sm:grid-cols-4">
              {photos.map((photo) => (
                <CoverOption
                  key={photo.id}
                  photo={photo}
                  selected={coverId === photo.id}
                  onSelect={() => setCoverId(coverId === photo.id ? null : photo.id)}
                />
              ))}
            </div>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}

function CoverOption({
  photo,
  selected,
  onSelect,
}: {
  photo: Photo;
  selected: boolean;
  onSelect: () => void;
}) {
  const media = useMediaSrc(photo, "thumbnail");
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Chọn ${photo.originalFilename} làm ảnh bìa`}
      className={cn(
        "group relative overflow-hidden rounded-xl transition-all duration-200",
        selected ? "ring-2 ring-rose ring-offset-2 ring-offset-cloud" : "hover:-translate-y-0.5",
      )}
    >
      <PhotoThumb
        src={media.src}
        alt={photo.originalFilename}
        rounding="rounded-xl"
        className="aspect-square"
        fallbackLabel="Không xem trước"
      />
      {selected ? (
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-rose text-warm"
        >
          <Check className="size-3" aria-hidden />
        </motion.span>
      ) : (
        <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-cloud/80 text-ink-soft opacity-0 transition-opacity group-hover:opacity-100">
          <Camera className="size-3" aria-hidden />
        </span>
      )}
    </button>
  );
}
