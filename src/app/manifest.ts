import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WiseSplit",
    short_name: "WiseSplit",
    description: "Split household expenses and record roommate settlements.",
    start_url: "/",
    display: "standalone",
    background_color: "#F3F5F3",
    theme_color: "#17211D",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml"
      }
    ]
  };
}
