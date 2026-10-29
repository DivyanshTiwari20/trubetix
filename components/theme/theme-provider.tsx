"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  scriptProps,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props} scriptProps={{ type: "text/plain", ...scriptProps }}>
      {children}
    </NextThemesProvider>
  );
}
