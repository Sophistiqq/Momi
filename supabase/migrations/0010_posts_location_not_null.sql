-- Make location and coordinates mandatory for map pins
update posts set location = 'Unknown location' where location is null or trim(location) = '';
update posts set lat = 0 where lat is null;
update posts set lng = 0 where lng is null;

alter table posts alter column location set not null;
alter table posts alter column lat set not null;
alter table posts alter column lng set not null;
