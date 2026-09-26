interface AvatarProps {
  name: string;
  size?: number;
}

export function Avatar({ name, size = 40 }: AvatarProps) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a5acb8] to-[#858994] font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initial}
    </div>
  );
}
