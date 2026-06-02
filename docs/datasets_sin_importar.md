# Datasets disponibles sin importar

Estos conjuntos de datos existen en `datos_hpe/` y estan documentados en
`docs/explicacion_dataset_ANTHEM.pdf`, pero **quedan fuera del alcance** actual
del proyecto: no tienen modelo Mongoose, importador, endpoint ni pagina en el
frontend. Se listan aqui para dejar constancia de que la omision es deliberada
(decision de alcance), no un olvido.

| Dataset | Archivo CSV | Motivo de exclusion |
| --- | --- | --- |
| Instalaciones fotovoltaicas | `Anthem_CTC_InstalacionesFotovoltaicas.csv` | Fuera de alcance funcional del dashboard de movilidad/medioambiente actual. Trae lat/long directos, seria de baja friccion integrar en el futuro. |
| Estacionamiento regulado (SER) | `Anthem_CTC_CallesEstacionamientoRegulado.csv` | Fuera de alcance. Coordenadas en UTM ETRS-89. |
| Ocupacion de aparcamientos rotacionales | `Anthem_CTC_OcupacionAparcamientosRotacionales.csv` | Fuera de alcance. Serie temporal (anio/mes) por aparcamiento. |
| Taxi - objetos perdidos | `Anthem_CTC_Taxi_ObjetosPerdidos.csv` | Fuera de alcance. |
| Taxi - reserva de paradas | `Anthem_CTC_Taxi_ReservaParadas.csv` | Fuera de alcance. Coordenadas UTM ETRS-89. |
| Callejero | `Anthem_CTC_Callejero.csv` | Dataset de referencia (maestro de vias/numeraciones). No se importa como recurso propio; podria usarse como apoyo de geocodificacion offline. |

Si en el futuro se decide integrar alguno, el patron a seguir es el del resto de
recursos: sub-schema + modelo en `src/models/`, importador en
`scripts/importation/` (reutilizando `helpers/coordenadas.js` para geo),
servicio de agregaciones en `src/services/`, controlador, rutas y pagina/hook
en el frontend.
