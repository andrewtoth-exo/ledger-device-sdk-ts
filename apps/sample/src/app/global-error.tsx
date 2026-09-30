"use client";

import React from "react";
import Error, { type ErrorProps } from "next/error";

export default function GlobalError({ error }: { error: ErrorProps }) {
  return (
    <html>
      <body>
        <Error {...error} />
      </body>
    </html>
  );
}
