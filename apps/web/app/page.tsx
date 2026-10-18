import { InstantQuoteConfigurator } from "@/components/landing/instant-quote-configurator"

export const metadata = {
  title: "OI Manufacture · Instan 3D Printing Quote & On-Demand Production",
  description:
    "Upload file STL CAD Anda, dapatkan analisis geometri instan, pilih material industri (FDM, SLA Resin, SLS), dan checkout langsung via Kasera QRIS & Virtual Account.",
}

export default function HomePage() {
  return <InstantQuoteConfigurator />
}
