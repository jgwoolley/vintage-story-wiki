'use client';

import EmotionRegistry from "@/components/EmotionRegistry";
import SnackbarProvider from "@/components/SnackbarProvider";
import siteInfo from "@/utils/siteInfo";
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { AppBar, Container, createTheme, CssBaseline, Menu, MenuItem, PaletteMode, Stack, ThemeProvider, Toolbar, Tooltip, Typography } from "@mui/material";
import Link from "next/link";
import { PropsWithChildren, useMemo, useState } from "react";
import { toolRoutes } from "./routes";
import { useBrowserIsDarkMode } from "@/hooks/useBrowserIsDarkMode";

function LayoutAppBarMenuItem({ href, children }: PropsWithChildren<{ href: string }>) {
    return (
        <MenuItem><Link style={{ color: "inherit", textDecoration: "inherit" }} href={href}>{children}</Link></MenuItem>
    )
}

function LayoutAppBarMenu() {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    const handleClick = (event: React.MouseEvent<HTMLLIElement>) => {
        setAnchorEl(event.currentTarget);
    };
    const handleClose = () => {
        setAnchorEl(null);
    };

    return (
        <>
            <Tooltip title="Menu options.">
                <MenuItem
                    id="basic-button"
                    aria-controls={open ? 'basic-menu' : undefined}
                    aria-haspopup="true"
                    aria-expanded={open ? 'true' : undefined}
                    onClick={handleClick}
                >
                    Menu
                </MenuItem>
            </Tooltip>
            <Menu
                id="basic-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
                slotProps={{
                    list: {
                        'aria-labelledby': 'basic-button',
                    }
                }}
            >
                {toolRoutes.map((x, index) => (<LayoutAppBarMenuItem key={index} href={x.href}>{x.shortName}</LayoutAppBarMenuItem>))}
            </Menu>
        </>
    )
}

function LayoutAppBar() {
    return (
        <AppBar position="static">
            <Container maxWidth="xl">
                <Toolbar disableGutters >
                    <MenuBookIcon sx={{ mr: 1 }} />
                    <Typography variant="h6" color="inherit" component="div">
                        <Link style={{ color: "inherit", textDecoration: "inherit" }} href="/">{siteInfo.title}</Link>
                    </Typography>
                    <div style={{ flex: 1 }} />
                    <Stack direction="row">
                        <LayoutAppBarMenu />
                    </Stack>
                </Toolbar>
            </Container>
        </AppBar>
    )
}

export type ColorMode = "dark" | "light" | "system";

const colorModeLut: Readonly<Record<ColorMode, PaletteMode | undefined>> = {
    dark: 'dark',
    light: 'light',
    system: undefined,
};

export default function LayoutComponent({ children }: PropsWithChildren) {
    const [colorMode] = useState<ColorMode>("system");
    const browserIsDarkMode = useBrowserIsDarkMode();

    const theme = useMemo(() => {
        let mode = colorModeLut[colorMode];
        if (colorMode === "system") {
            mode = browserIsDarkMode ? "dark" : "light";
        }

        return createTheme({
            palette: {
                mode: mode,
            },
        });

    }, [browserIsDarkMode, colorMode]);

    return (
        <ThemeProvider theme={theme}>
            <EmotionRegistry>
                <SnackbarProvider>
                    <Container>
                        <LayoutAppBar />
                        {children}
                    </Container>
                </SnackbarProvider>
            </EmotionRegistry>
            <CssBaseline />
        </ThemeProvider>
    );
}