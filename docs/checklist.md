# Lista de rutas realizadas de la API REST
- [X] Censo -> Demasiado tiempo procesando archivos, +200K lineas por documento | paralelismo? && no cierra conexion cuando termina
- [X] Multas -> No cierra la conexion al terminar
- [X] Contaminacion acustica
- [X] Calidad de aire -> No cierra conexion cuando termina
- [X] Ubicaciones
- [X] Trafico -> +1 millon de lineas por documento, problemas de velocidad | optimizar?
- [X] Accidentalidad
- [X] Asignación de patinetes
- [X] Contenedores

CONTROL DE DUPLICADOS???

---

# Semana del 6 de octubre al 12 de octubre
- [] Ocupación aparcamientos rotacionales
- [] Reserva paradas taxi

# Resto de rutas
- [] Peatones y bicicletas
- [] Callejero

---

formar JWT unicamente sabiendo la clave publica, un atacante puede generar tokens JWT de admin sabiendo el algoritmo que usamos y la clave publica. ¿Sommos vulnerables a esto? ¿Es un riesgo real en nuestra API? ¿Que medidas podemos tomar para mitigarlo en caso de que seamos vulnerables?

---

consider a quick import dry-run for fines to confirm no dropped rows and unchanged metrics, and run API smoke tests around auth responses to verify the new toJSON transforms don’t affect consumers.