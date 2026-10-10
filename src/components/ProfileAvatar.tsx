import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { toneClass } from "./format";

export function ProfileAvatar({ name, src }: { name: string; src?: string }) {
  const imageSource = src || "";
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [imageSource]);

  return (
    <span className={`avatar profile-avatar ${toneClass(name)}`} aria-hidden="true">
      {imageSource && !imageFailed ? (
        <img
          src={imageSource}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <UserRound className="lucide-icon" strokeWidth={1.9} />
      )}
    </span>
  );
}
