import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "TWAP bot",
  description: "Plan and run TWAP orders on Lambdaplex, with a verifiable HCS track record of every settled fill.",
});

export default function BotsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
