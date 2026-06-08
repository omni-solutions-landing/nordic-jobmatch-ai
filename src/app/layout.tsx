import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

// Since we have a `[locale]` layout wrapping everything, the root layout is just a pass-through
export default function RootLayout({ children }: Props) {
  return children;
}
