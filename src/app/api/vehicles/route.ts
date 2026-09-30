import {getVehicles} from '../../../lib/vehicles';export async function GET(){return Response.json({inventory:await getVehicles()})}
