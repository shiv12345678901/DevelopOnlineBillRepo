import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { toneClass } from "./format";

const PROFILE_FILES: Record<string, string> = {
  shiva: "shiva.png",
  arpan: "arpan.png",
  arjun: "arjun.png",
  swasti: "swasti.png",
};

export function ProfileAvatar({ name, src }: { name: string; src?: string }) {
  const firstName = name.trim().split(/\s+/)[0].toLocaleLowerCase();
  const fileName = PROFILE_FILES[firstName];
  const imageSource = src || (fileName ? `/profile-images/${fileName}` : "");
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
