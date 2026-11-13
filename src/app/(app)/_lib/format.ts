const numberFormat = new Intl.NumberFormat("en-US");

/** 1234567 as "1,234,567". */
export const formatNumber = (n: number) => numberFormat.format(n);

/** "1 credit", "140 credits". */
export const creditsWords = (n: number) => `${formatNumber(n)} ${n === 1 ? "credit" : "credits"}`;

/** True when there is no price to pay, or the balance covers it. */
export const canAfford = (price: number | null, balance: number) =>
  price === null || balance >= price;

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** "12 Nov, 14:05". */
export const formatWhen = (date: Date) => dateFormat.format(date);
