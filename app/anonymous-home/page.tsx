import { HomeEntry } from "../components/HomeEntry";
import { homeMetadata } from "../lib/homeMetadata";

export const metadata = homeMetadata;

export default function AnonymousHome() {
  return <HomeEntry folders={[]} />;
}
