
import { Breadcrumbs } from "@mui/material";
import Link from "next/link";

import { Link as MuiLink } from "@mui/material";
import { usePathname } from "next/navigation";

export default function LayoutBreadcrumbs() {
    const pathname = usePathname();
    const pathnames = pathname.split('/').filter(path => path);
    return (
        <Breadcrumbs>
            <MuiLink component={Link} href="/" color="inherit">
                Home
            </MuiLink>
            {pathnames.map((value, index) => {
                const href = `/${pathnames.slice(0, index + 1).join('/')}`;
                return (
                    <MuiLink key={index} component={Link} href={href} color="inherit">
                        {value}
                    </MuiLink>
                );
            })}
        </Breadcrumbs>
    )
}