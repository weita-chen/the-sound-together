import { createFileRoute } from "@tanstack/react-router";
import { Journey } from "@/components/journey";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <Journey />;
}
