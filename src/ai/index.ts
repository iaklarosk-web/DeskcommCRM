/**
 * A camada de IA do turno SaaS (§5.8). Hoje só a porta de chamada ao provedor:
 * a orquestração do turno chega nas tasks seguintes da F04.
 */
export {
  chamarModelo,
  type DepsDaChamada,
  type EntradaDaChamada,
  type SaidaDaChamada,
} from "./chamada";
