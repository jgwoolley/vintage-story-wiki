'use client';

import { Autocomplete, Grid, TextField } from "@mui/material";
import { useState } from "react";

type Month = {
    index: number,
    name: string,
};

const months: Month[] = [
    { name: "January", index: 0 },
    { name: "February", index: 1 },
    { name: "March", index: 2 },
    { name: "April", index: 3 },
    { name: "May", index: 4 },
    { name: "June", index: 5 },
    { name: "July", index: 6 },
    { name: "August", index: 7 },
    { name: "September", index: 8 },
    { name: "October", index: 9 },
    { name: "November", index: 10 },
    { name: "December", index: 11 },
];

export default function PageComponent() {
    const [daysPerMonth, setDaysPerMonth] = useState<number>(9);
    const [year, setYear] = useState<number>(0);
    const [month, setMonth] = useState<Month>(months[4]);
    const [dayOfMonth, setDayOfMonth] = useState<number>(0);

    return (
        <>
            <h3>Calendar</h3>
            <h4>Calendar Settings</h4>
            <Grid container rowSpacing={4} columnSpacing={2}>
                <Grid size={{xs: 12 }}>
                    <TextField
                        label="Days Per Month"
                        type="number"
                        value={daysPerMonth}
                        onChange={(x) => setDaysPerMonth(parseInt(x.target.value))}
                        fullWidth
                    />
                </Grid>
                <Grid size={{xs: 12, sm: 4 }}>
                    <TextField
                        label="Year"
                        type="number"
                        value={year}
                        onChange={(x) => setYear(parseInt(x.target.value))}
                        fullWidth
                    />
                </Grid>
                <Grid size={{xs: 12, sm: 4 }}>
                    <Autocomplete
                        disablePortal
                        options={months}
                        getOptionLabel={x => x.name}
                        value={month}
                        onChange={(_, newValue) => {
                            if (newValue) {
                                setMonth(newValue);
                            }
                        }}
                        renderInput={(params) => <TextField {...params} label="Month" />}
                        fullWidth
                    />
                </Grid>
                <Grid size={{xs: 12, sm: 4 }}>
                    <TextField
                        label="Day"
                        type="number"
                        value={dayOfMonth}
                        onChange={(x) => setDayOfMonth(parseInt(x.target.value))}
                        fullWidth
                    />
                </Grid>
            </Grid>

            <p>{`${daysPerMonth * 0.8} real life hours per month.`}</p>
            <p>{`${daysPerMonth * 0.8 * 12} real life hours per year.`}</p>
            <p>{(year * 12 * daysPerMonth) + (month.index * daysPerMonth) + (dayOfMonth)} hours</p>
            
            <h3>Calendar</h3>
            
        </>
    )
}