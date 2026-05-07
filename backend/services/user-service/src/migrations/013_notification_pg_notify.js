/**
 * After INSERT on notifications, NOTIFY user-service listeners (event-driven WS push).
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION acadconnect_notify_notification_insert()
    RETURNS TRIGGER AS $$
    BEGIN
      PERFORM pg_notify(
        'acadconnect_notifications',
        json_build_object('user_id', NEW.user_id::text)::text
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_acadconnect_notification_insert ON notifications;
    CREATE TRIGGER trg_acadconnect_notification_insert
    AFTER INSERT ON notifications
    FOR EACH ROW
    EXECUTE PROCEDURE acadconnect_notify_notification_insert();
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_acadconnect_notification_insert ON notifications;
    DROP FUNCTION IF EXISTS acadconnect_notify_notification_insert();
  `);
};
