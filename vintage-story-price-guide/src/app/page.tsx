import { Card, CardActionArea, CardContent, CardHeader, Grid, IconButton, Tooltip, Typography } from '@mui/material';
import Link from 'next/link';
import { RouteInfo, toolRoutes } from './routes';

function ToolCard({ name, description, href, IconComponent }: RouteInfo) {
  return (
    <Card 
      sx={{ 
        height: '100%', 
        width: '100%', 
        display: 'flex', 
        flexDirection: 'column',
      }}
    >
      <CardActionArea
        LinkComponent={Link}
        href={href}
        sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}
      >
        <CardHeader
          avatar={
            <Tooltip title={name}>
              <IconButton aria-label={`${name} icon`} disableRipple>
                <IconComponent />
              </IconButton>
            </Tooltip>
          }
          title={<Typography variant="h6">{name}</Typography>}
        />
        <CardContent sx={{ flexGrow: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

export default async function Home() {
  return (
    <>
      <Grid container spacing={4} sx={{ p: 4 }}>
        {toolRoutes.map(({name, description, href, IconComponent, shortName}, index) => (
        <ToolCard
            key={index}
            name={name}
            description={description}
            shortName={shortName}
            href={href}
            IconComponent={IconComponent}
          />
        ))}
      </Grid>
    </>
  );
}