import dynamic from "next/dynamic";

const FlowchartClient = dynamic(() => import("./FlowchartClient"), {
  ssr: false,
  loading: () => <div style={{ padding: 24 }}>Loading...</div>,
});

export default function Page() {
  return <FlowchartClient />;
}
