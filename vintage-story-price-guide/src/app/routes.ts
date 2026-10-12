import LocalGroceryStoreIcon from '@mui/icons-material/LocalGroceryStore';
import MapIcon from '@mui/icons-material/Map';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';

export type RouteInfo = Readonly<{
  name: string,
  shortName: string,
  description: string,
  href: string,
  IconComponent: React.ComponentType,
}>;

export const tradesRoute: RouteInfo = {
    name: 'Vintage Story Trades Tool',
    shortName: 'Trades',
    description: 'Get the best deals with wandering traders! The best price guide around.',
    href: '/trades',
    IconComponent: LocalGroceryStoreIcon,
}

export const wayPointRoute: RouteInfo = {
    name: 'Vintage Story WayPoint Tool',
    shortName: 'WayPoints',
    description: 'Are you a clockmaker whose daliance with translocators has massively reduced the time it takes to get from point A to point B, but planning the optimal route has taken its tole on your sanity? Look no furhter than the WayPoint tool!',
    href:'/waypoints',
    IconComponent: MapIcon,
}

export const calendarRoute: RouteInfo = {
    name: 'Vintage Story Calendar Tool',
    shortName: 'Calendar',
    description: 'Having trouble keeping track of when your sheep give birth, or when traders are restocked? Look no further than the calendar tool!',
    href:'/calendar',
    IconComponent: CalendarMonthIcon,
}

export const toolRoutes: Readonly<RouteInfo[]> = [
    tradesRoute,
    wayPointRoute,
    calendarRoute,
];