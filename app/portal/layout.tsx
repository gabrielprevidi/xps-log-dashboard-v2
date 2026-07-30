import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Portal do Cliente — XPS Log',
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
