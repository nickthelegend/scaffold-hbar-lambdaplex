import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const market = decodeURIComponent(symbol).replace("-", "/");
  return getMetadata({
    title: market,
    description: `Live ${market} order book, trades and price chart from Lambdaplex, Hedera's order-book exchange.`,
  });
}

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
