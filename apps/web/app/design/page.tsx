import { notFound } from "next/navigation";
import Specimen from "./specimen";

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <Specimen />;
}
