import {
  CircleDollarSign,
  ArrowLeftRight,
  ChartPie,
  Clock3,
  Cloud,
  FileText,
  House,
  Info,
  Moon,
  Search,
  Settings,
  ShoppingBasket,
  Store,
  Sun,
  Utensils,
  UsersRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS = {
  house: House,
  docText: FileText,
  clock: Clock3,
  chart: ChartPie,
  gear: Settings,
  search: Search,
  sun: Sun,
  moon: Moon,
  people: UsersRound,
  dollar: CircleDollarSign,
  settle: ArrowLeftRight,
  cloud: Cloud,
  info: Info,
  grocery: ShoppingBasket,
  store: Store,
  dining: Utensils,
  utilities: Zap,
} satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof ICONS;

export function AppIcon({ name, active = false }: { name: AppIconName; active?: boolean }) {
  const Icon = ICONS[name];

  return (
    <Icon
      className={`lucide-icon${active ? " lucide-icon--active" : ""}`}
      strokeWidth={active ? 2.25 : 1.9}
      aria-hidden="true"
    />
  );
}
