import { wayPointRoute } from "../routes";
import PageComponent from "./PageComponent";
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: wayPointRoute.name,
  description: wayPointRoute.description,
};

export default function Page() {
  return (
    <PageComponent />
  );
}