import { stringifyWayPoint, WayPoint } from "@/utils/utils";;

export type WayPointSelectionProps = {
    name: string,
    id: string,
    node: WayPoint | undefined,
    setNode: (value: WayPoint | undefined) => void,
    waypoints: WayPoint[],
    emptyValid: boolean,
}

export default function WayPointSelection({ waypoints, node, setNode, name, id, emptyValid }: WayPointSelectionProps) {
    return (
        <select
            name={name}
            id={id}
            value={node ? waypoints.indexOf(node) : ''}
            onChange={
                e => {
                    const { value: indexRaw } = e.target;
                    const index = parseInt(indexRaw, 10);
                    const value = waypoints[index];
                    console.log({index, value});
                    setNode(value);
                }
            }
        >
            {emptyValid ? <option value="" /> : (!node && <option value="" disabled>Select a WayPoint</option>)}
            {waypoints.map((row, index) => (
                <option key={index} value={index}>{stringifyWayPoint(row)}</option>)
            )}
        </select>
    )
}