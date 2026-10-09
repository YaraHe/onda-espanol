import { redirect } from "next/navigation";

// Keep old bookmarks usable without exposing the retired system library.
export default function LibraryPage() {
  redirect("/");
}
