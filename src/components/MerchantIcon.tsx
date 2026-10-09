import { AppIcon, type AppIconName } from "./AppIcon";
import { toneClass } from "./format";

const MERCHANT_LOGOS = [
  { match: /woolworths/i, src: "/merchant-icons/woolworths.svg", className: "receipt-avatar--woolworths" },
  { match: /^agl\b/i, src: "/merchant-icons/agl.svg", className: "" },
];

function categoryIcon(category: string): AppIconName {
  const value = category.toLocaleLowerCase();
  if (value.includes("utilit")) return "utilities";
  if (value.includes("dining") || value.includes("restaurant")) return "dining";
  if (value.includes("grocer")) return "grocery";
  return "store";
}

export function MerchantIcon({ merchant, category }: { merchant: string; category: string }) {
  const logo = MERCHANT_LOGOS.find(({ match }) => match.test(merchant));

  return (
    <span
      className={`avatar receipt-avatar ${toneClass(category || merchant)}${logo ? ` receipt-avatar--brand ${logo.className}` : ""}`}
      aria-hidden="true"
    >
      {logo ? (
        <img src={logo.src} alt="" loading="lazy" decoding="async" />
      ) : (
        <AppIcon name={categoryIcon(category)} />
      )}
    </span>
  );
}
